import { z } from "zod";
import { createApp } from "./app.js";
import { loadMatchingEnv } from "./env.js";

const env = loadMatchingEnv(process.env);
const port = z.coerce
  .number()
  .int()
  .positive()
  .default(4002)
  .parse(process.env.MATCHING_PORT ?? process.env.PORT);
const app = createApp(env);

app.listen(port, () => {
  console.log(`matching service listening on port ${port}`);
});
