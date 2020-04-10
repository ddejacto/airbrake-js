export interface IHttpRequest {
    method: string;
    url: string;
    body: string;
    timeout?: number;
}
export interface IHttpResponse {
    json: any;
}
export declare type Requester = (req: IHttpRequest) => Promise<IHttpResponse>;
export declare let errors: {
    unauthorized: Error;
    ipRateLimited: Error;
};
