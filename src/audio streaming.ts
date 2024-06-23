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
    let botId = ""
    let queue = fastq.promise(humeAudioPlayer, 1)

    const rawSocket = new WebSocket("wss://api.hume.ai/v0/evi/chat?api_key=" + process.env.HUME_API_KEY)
    rawSocket.onopen = () => {
        console.log('hume socket opened')
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

    let counter = 0
    let buffers: Buffer[] = []

    let writes = 0
      
    ws.on("message", async (data: Buffer, isBinary) => {
        try {
            if (!isBinary) {
                const initialMessage = JSON.parse(data.toString())
                console.log('recall.ai init', initialMessage)
                botId = initialMessage.bot_id
                connections.set(ws, { botId })
            } else if (queue.idle()) {
                const s16le = data
                buffers.push(s16le)
                if (buffers.length >= 5) {
                    const concat = Buffer.concat(buffers)
                    // fs.writeFileSync(`segment${writes}.raw`, concat, "binary")
                    const wav = await convertS16LEToWavBase64(concat)
                    // fs.writeFileSync(`segment${writes}.wav`, wav, "binary")
                    rawSocket.send(JSON.stringify({
                        data: wav.toString("base64"),
                        type: "audio_input"
                    }))
                    buffers = []
                    writes += 1
                }
                // fs.writeFileSync("original.raw", Buffer.concat(buffers), "binary")
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