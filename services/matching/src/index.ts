import { z } from "zod";
import { loadEnv } from "@pace-partner/shared";
import { createApp } from "./app.js";

loadEnv(process.env);

const port = z.coerce.number().int().positive().default(4002).parse(process.env.PORT);
const app = createApp();

app.listen(port, () => {
  console.log(`matching service listening on port ${port}`);
});
