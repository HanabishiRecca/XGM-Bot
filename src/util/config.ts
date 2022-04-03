import { readFileSync } from 'fs';

type Configs = {

    bot: {
        server: string;
        roles: string[];
    };

    commands: {
        embed_message_color: number;
        embed_error_color: number;
    };

    marks: Record<string, Record<string, Record<string, string>>>;

    news: {
        back_messages_limit: number;
        embed_color: number;
    };

    users: {
        roles: string[];
    };

};

const readOptions = { encoding: 'utf8' } as const;

export const LoadConfig = <T extends keyof Configs>(name: T) =>
    JSON.parse(readFileSync(`${process.cwd()}/config/${name}.json`, readOptions)) as Configs[T];
