import { WebSocket, WebSocketServer } from "ws"
import url from 'url';
import { Hume, HumeClient, convertBlobToBase64 } from 'hume';
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";
import base64 from "base64-stream";
import fs from "fs";

const socketServer = new WebSocketServer({ port: 3019, path: "/audio-stream", clientTracking: false, maxPayload: 1048576 })
const humeClient = new HumeClient({
    apiKey: process.env.HUME_API_KEY,
    secretKey: process.env.HUME_SECRET_KEY
})

const connections = new Map<WebSocket, Record<string, any>>()

socketServer.on("connection", async (ws, request) => {
    console.log(`Received audio streaming connection from ${request.socket.remoteAddress}:${request.socket.remotePort}`);
    connections.set(ws, {})
    const query = url.parse(request.url ?? '', true).query;
    let botId = ""

    const rawSocket = new WebSocket("wss://api.hume.ai/v0/evi/chat?api_key=" + process.env.HUME_API_KEY)
    rawSocket.onopen = () => {
        console.log('hume socket opened')
    }

    rawSocket.onmessage = (e) => {
        console.log('received hume message', e)
    }

    let counter = 0
    let buffers: Buffer[] = []
      
    ws.on("message", async (data: Buffer, isBinary) => {
        try {
            if (!isBinary) {
                const initialMessage = JSON.parse(data.toString())
                console.log('1st message', initialMessage)
                botId = initialMessage.bot_id
                connections.set(ws, { botId })
            } else {
                const s16le = data
                buffers.push(data)
                fs.writeFileSync("original.raw", Buffer.concat(buffers), "binary")
                const b64 = await convertS16LEToWavBase64(s16le)
                rawSocket.send(JSON.stringify({
                    data: b64,
                    type: "audio_input"
                }))
                console.log('sent', b64.length, Date.now() / 1000)
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
    return new Promise<string>((resolve, reject) => {
      const inputStream = new PassThrough();
      const outputStream = fs.createWriteStream("out.wav"); //
      const s16leToWavStream = new PassThrough(); 
      let base64String = '';
  
      // Write the buffer to the input stream
      inputStream.end(buffer);
  
      // Set up the ffmpeg command
      ffmpeg().input(inputStream)
        .inputFormat('s16le')
        .audioCodec('pcm_s16le')
        .audioChannels(1) // Assuming the S16LE format is stereo
        .audioFrequency(16000) // Assuming a sample rate of 44100 Hz
        .toFormat('wav')
        // .on('end', () => {
        //   // Resolve with the base64 string once the conversion is done
        //   resolve(base64String);
        // })
        .pipe(s16leToWavStream);
        s16leToWavStream.pipe(outputStream)
  
      // Collect the output stream data as a base64 string
      s16leToWavStream.on('data', (chunk) => {
        base64String += chunk.toString('base64');
      });

      s16leToWavStream.on('end', () => {
        // Resolve with the base64 string once the conversion is done
        resolve(base64String);
      });
    });
  }