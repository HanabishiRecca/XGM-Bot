import { readFileSync } from 'fs';

export type Config = {
    server: string;
    roles: string[];
    marks: MarkChannels;
};

type MarkChannels = Record<string, MarkMessages>;
type MarkMessages = Record<string, MarkReactions>;
type MarkReactions = Record<string, string>;

export const config = JSON.parse(readFileSync(`${process.cwd()}/config.json`, { encoding: 'utf8' })) as Config;
export default config;
