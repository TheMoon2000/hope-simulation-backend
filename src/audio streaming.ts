import { WebSocket, WebSocketServer } from "ws"
import url from 'url';
import { Hume, HumeClient, convertBlobToBase64 } from 'hume';
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";
import base64 from "base64-stream";
import fs from "fs";
import { recallInstance } from "./constants";
import fastq, { worker } from "fastq";
import { isBuiltin } from "module";
//@ts-ignore
import getMP3Duration from "get-mp3-duration"
import { connectToDB } from "./mongodb";
import { ObjectId } from "mongodb";

const socketServer = new WebSocketServer({ port: 3019, path: "/audio-stream", clientTracking: false, maxPayload: 1048576 })
const humeClient = new HumeClient({
    apiKey: process.env.HUME_API_KEY,
    secretKey: process.env.HUME_SECRET_KEY
})

const connections = new Map<WebSocket, Record<string, any>>()

async function humeAudioPlayer([mp3, botId]: [Buffer, string]) {
    const duration = getMP3Duration(mp3) as number
    console.log('duration', duration, botId)
    await recallInstance.post(`/bot/${botId}/output_audio/`, {
        kind: "mp3",
        b64_data: mp3.toString("base64")
    }).then(async (r) => {
        console.log('recall.ai send audio response', r.data)
        if (duration) {
            await new Promise((r, _) => setTimeout(r, duration + 500))
        }
    }).catch(err => {
        // user closed the room, quitting
        console.log('room closed', botId)
    })
}

socketServer.on("connection", async (ws, request) => {
    console.log(`Received audio streaming connection from ${request.socket.remoteAddress}:${request.socket.remotePort}`);
    connections.set(ws, {})
    const query = url.parse(request.url ?? '', true).query;
    const scenarioId = query.scenarioId as string
    if (!scenarioId) {
        ws.close(4000, "Must provide scenarioId.")
    }
    let botId = ""
    let humeConfigId = ""
    let queue = fastq.promise(humeAudioPlayer, 1)

    let rawSocket: WebSocket | undefined

    let buffers: Buffer[] = []
      
    ws.on("message", async (data: Buffer, isBinary) => {
        try {
            if (!isBinary) {
                const initialMessage = JSON.parse(data.toString())
                console.log('recall.ai init', initialMessage)
                botId = initialMessage.bot_id
                connections.set(ws, { botId })
                if (!rawSocket) {
                    const mongoClient = await connectToDB()
                    const database = mongoClient.db("HopeDB");
                    const sessions = database.collection("Sessions");
                    const scenarios = database.collection("Scenarios");
                    console.log('scenarioId', scenarioId)
                    const scenarioInfo = (await scenarios.findOne({ _id: new ObjectId(scenarioId) }))!
                    console.log('scenario info', scenarioInfo)
                    const { humeConfigId } = scenarioInfo
                    rawSocket = new WebSocket(`wss://api.hume.ai/v0/evi/chat?api_key=${process.env.HUME_API_KEY}&config_id=${humeConfigId}`)
                    rawSocket.onopen = () => {
                        console.log('hume socket opened', humeConfigId)
                    }

                    rawSocket.onmessage = async (e) => {
                        const parsed = JSON.parse(e.data as string)
                        const audio = parsed.data
                        if (typeof audio === "string") {
                            const wav = Buffer.from(audio, "base64")
                            const mp3 = await convertWavToMp3(wav)
                            // fs.writeFileSync(parsed.id + ".mp3", mp3, "binary")
                            queue.push([mp3, botId])
                        } else {
                            console.log('hume response', parsed)
                        }
                    }
                }
                
            } else if (queue.idle()) {
                const s16le = data
                buffers.push(s16le)
                if (buffers.length >= 5) {
                    const concat = Buffer.concat(buffers)
                    // fs.writeFileSync(`segment${writes}.raw`, concat, "binary")
                    const wav = await convertS16LEToWavBase64(concat)
                    // fs.writeFileSync(`segment${writes}.wav`, wav, "binary")
                    rawSocket?.send(JSON.stringify({
                        data: wav.toString("base64"),
                        type: "audio_input"
                    }))
                    buffers = []
                }
            } else {
                console.log('pausing, waiting for queue', queue.length())
            }
        } catch (err) {
            console.error("error", err)
        }
    })

    ws.on("close", (code, reason) => {
        console.log('close connection')
        // connections.delete(ws)
    })
})

function convertS16LEToWavBase64(buffer: Buffer) {
    return new Promise<Buffer>((resolve, reject) => {
      const inputStream = new PassThrough();
      const s16leToWavStream = new PassThrough(); 
      let chunks: Buffer[] = []
  
      // Write the buffer to the input stream
      inputStream.end(buffer);
  
      // Set up the ffmpeg command
      ffmpeg(inputStream)
      .inputFormat('s16le')
      .inputOptions(["-ac 1", "-ar 16000"])
      .toFormat("wav")
      .pipe(s16leToWavStream, {end: true});
  
      // Collect the output stream data as a base64 string
      s16leToWavStream.on('data', (chunk) => {
        chunks.push(chunk)
      });

      s16leToWavStream.on('end', () => {
        // Resolve with the base64 string once the conversion is done
        resolve(Buffer.concat(chunks));
      });
    });
}

// const wav = fs.readFileSync("02b84e9c4f4341cda10f3048437b8bb3.wav")
// convertWavToMp3(wav).then(b => fs.writeFileSync("02b.mp3", b, "binary"))

function convertWavToMp3(buffer: Buffer) {
    return new Promise<Buffer>((resolve, reject) => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough(); 
      let chunks: Buffer[] = []
  
      // Write the buffer to the input stream
      inputStream.end(buffer);
  
      // Set up the ffmpeg command
      ffmpeg(inputStream)
      .inputFormat('wav')
      .audioChannels(1) // Mono audio
      .audioFrequency(24000)
    //   .inputOptions(["-ac 1", "-ar 24000"])
    //   .audioCodec("libmp3lame")
        .audioCodec('libmp3lame')
      .toFormat("mp3")
      .pipe(outputStream, {end: true});
  
      // Collect the output stream data as a base64 string
      outputStream.on('data', (chunk) => {
        chunks.push(chunk)
      });

      outputStream.on('end', () => {
        // Resolve with the base64 string once the conversion is done
        resolve(Buffer.concat(chunks));
      });
    });
}

async function getAudioDuration(buffer: Buffer): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const stream = new PassThrough();
      stream.end(buffer);
  
      ffmpeg(stream)
        .ffprobe((err, data) => {
          if (err) {
            reject(err);
          } else {
            const duration = data.format.duration;
            resolve(duration ?? 0);
          }
        });
    });
}

function getFormattedPrompt(data: Record<string, any>) {
    const description = `You are {name}. {name} is a {age}-year-old {occupation} who is currently feeling distressed and struggling with negative thoughts, particularly a sense of not belonging and worthlessness. Overwhelmed with both school and personal issues, {name}'s mental state has led to noticeable changes in behavior and routines.

Previously an active participant in social activities, {name} now frequently withdraws from these interactions, often preferring to stay isolated. This withdrawal extends to their academic life, where they have stopped attending classes regularly, leading to a decline in academic performance.

These feelings of distress and negative self-worth have also impacted {name}'s physical well-being. There have been significant changes in their sleep patterns, with {name} either sleeping too much or suffering from insomnia. Similarly, their eating habits have become irregular, sometimes eating very little and other times overeating.

{name}'s once vibrant and engaged presence has dimmed, replaced by a person struggling to find a sense of purpose and belonging amid the overwhelming pressures of college and personal life.

Here is a list of actions you've done recently: {actions}.
`;
    return description.format(data)
}