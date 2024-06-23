import 'dotenv/config';
import jwt from 'jsonwebtoken';

const payload = {
  iss: process.env.ZOOM_CLIENT_ID,
  exp: ((new Date()).getTime() + 7 * 86400 * 1000) // Token expires in 5 seconds
};

const token = jwt.sign(payload, process.env.ZOOM_CLIENT_SECRET);
console.log(token);