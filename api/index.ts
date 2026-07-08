// @ts-ignore
import appInstance from "../dist/server.cjs";
const app = appInstance.default || appInstance;

export const config = {
  api: {
    bodyParser: false,
  },
};

export default app;



