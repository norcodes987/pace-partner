import { z } from "zod";
import { createApp } from "./app.js";
import { loadAuthEnv } from "./env.js";

const env = loadAuthEnv(process.env);
const port = z.coerce
  .number()
  .int()
  .positive()
  .default(4001)
  .parse(process.env.AUTH_PORT ?? process.env.PORT);
const app = createApp(env);

app.listen(port, () => {
  console.log(`auth service listening on port ${port}`);
});
