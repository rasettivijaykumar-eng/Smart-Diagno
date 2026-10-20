import { app } from "./app.ts";

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Smart Diagno API listening on port ${port} (AI ${process.env.GEMINI_API_KEY ? "configured" : "not configured"}, Google sign-in ${process.env.GOOGLE_CLIENT_ID ? "configured" : "not configured"})`));
