type LogseneHttpOptions = {
  maxSockets?: number;
  keepAlive?: boolean;
  maxFreeSockets?: number;
  // Allow for additional options that might not be accounted for
  [key: string]: any;
};

type LogseneOptions = {
  useIndexInBulkUrl?: boolean;
  httpOptions?: {[key: string]: any};
  // Allow for additional options that might not be accounted for
  [key: string]: any;
};

type LogFields = {
  _type?: string;
  _id?: string;
  [key: string]: any;
};

type Callback = (err: object, msg: object) => void;

declare class Logsene {
  constructor(
    token: string,
    type?: string,
    url?: string,
    storageDirectory?: string,
    options?: LogseneOptions
  );

  log(
    level: string,
    message: string,
    fields?: LogFields,
    callback?: Callback
  ): void;

  send(callback: Callback): void;
}

export = Logsene;