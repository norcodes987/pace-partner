import { z } from "zod";
import { loadEnv } from "@pace-partner/shared";
import { createApp } from "./app.js";

loadEnv(process.env);

const port = z.coerce.number().int().positive().default(4001).parse(process.env.PORT);
const app = createApp();

app.listen(port, () => {
  console.log(`auth service listening on port ${port}`);
});
