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

    const humeSocket = await humeClient.empathicVoice.chat.connect({
        onOpen: () => {
          console.log('Hume WebSocket connection opened');
        },
        onMessage: (message) => {
          console.log(message);
        },
        onError: (error) => {
          console.error(error);
        },
        onClose: () => {
          console.log('WebSocket connection closed');
        },

    });

    const rawSocket = new WebSocket("wss://api.hume.ai/v0/evi/chat?api_key=" + process.env.HUME_API_KEY)
    rawSocket.onopen = () => {
        console.log('hume socket opened')
    }

    rawSocket.onmessage = (e) => {
        console.log('received hume message', e)
    }

    let counter = 0
      
    ws.on("message", async (data: Buffer, isBinary) => {
        try {
          console.log("DATA:  ", data)
            if (!isBinary) {
              console.log(" THOIS SHOULD LOG");
                console.log("PEEEEEEEE: ", data.toString())
                const initialMessage = JSON.parse(data.toString())
                console.log('1st message', initialMessage)
                botId = initialMessage.bot_id
                connections.set(ws, { botId })
            } else {
                fs.writeFileSync("original.raw", data)
                const dataNew = data.subarray(4)
                fs.writeFileSync("out.raw", dataNew)
                
                const b64 = dataNew.toString("base64")
                const b64_ = await convertS16LEToWavBase64(dataNew)
                await humeSocket.sendAudioInput({
                    data: b64_,
                    customSessionId: botId
                })
                // if (counter < 10) {
                // rawSocket.send(JSON.stringify({
                //     data: b64_,
                //     type: "audio_input"
                // }))
                // counter++
                // console.log('sent', b64_.length)
                // }
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