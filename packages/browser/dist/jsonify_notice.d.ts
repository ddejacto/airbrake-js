import { INotice } from './notice';
export declare function jsonifyNotice(notice: INotice, { maxLength, keysBlacklist }?: {
    maxLength?: number;
    keysBlacklist?: any[];
}): string;
interface ITruncatorOptions {
    level?: number;
    keysBlacklist?: any[];
}
export declare function truncate(value: any, opts?: ITruncatorOptions): any;
export {};
