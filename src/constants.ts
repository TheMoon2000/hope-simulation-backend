import axios from "axios";

export const recallInstance = axios.create({ baseURL: "https://us-west-2.recall.ai/api/v1/", headers: {
    "Authorization": "Token bdfdebc7994d40f6b5e37dc81d27336ea128ca60"
} })
