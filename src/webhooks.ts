import { Router } from "express";
import { recallInstance } from "./constants";
import { connectToDB } from "./mongodb";

const webhookRouter = Router()

webhookRouter.post("/transcription", async (req, res) => {
    if (!req.body?.data?.transcript) {
        return res.status(400).send()
    }

    /*
    {
        event: 'bot.transcription',
        data: {
            bot_id: 'a64e6c44-5ed6-447e-8d68-e6c4c3f722dd',
            recording_id: 'e652a0c6-02cd-4e90-9cfe-2ed06ef8baec',
            transcript: {
            original_transcript_id: 1,
            speaker: 'Jerry Shan',
            speaker_id: 16778240,
            words: [
                {
                    text: "Executive is gonna, we're connected to chat you here or something. And you can't get that.",
                    start_time: 203.74098,
                    end_time: 209.25305
                }
            ],
            is_final: true,
            language: 'en',
            source: 'meeting_captions'
            }
        }
    }

    */

    const botId = req.body.data.bot_id
    console.log("received transcription", req.body.data.transcript.words)

    res.send()
})

webhookRouter.post("/on-meeting-ended", async (req, res) => {
    if (typeof req.body?.data?.bot_id === "string" && req.body.data.status?.code === "done") {
        const botId = req.body.data.bot_id as string

        const botInfo = await recallInstance.get(`/bot/${botId}/`)
        const client = await connectToDB()
        const database = client.db("HopeDB");
        const collection = database.collection("Sessions");
        await collection.updateOne(
            { botId: botId },
            { $set: { recordingUrl: botInfo.data.video_url } }
        )
        console.log('bot done', botId)
    }
})

export default webhookRouter;