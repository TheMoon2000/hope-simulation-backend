import express, { Express, Request, Response } from 'express';
import 'dotenv/config';
import cors from 'cors';
import webhookRouter from './webhooks';
import "./audio streaming";

const app: Express = express();
const PORT = 3018

const corsOptions = {
    origin: "*"
};
app.use(cors(corsOptions));

app.use(express.json({ limit: "1mb" }));
app.use("/webhooks", webhookRouter);

app.get('/', (req, res) => {
    res.json({ message: 'This is the API root of Hope Simulation backend.' });
});

app.listen(PORT, () => {
    console.log(`Hope Simulation backend is running on port ${PORT}.`);
});