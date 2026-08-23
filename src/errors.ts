export class ServiceError extends Error { constructor(public readonly status: number, public readonly code: string, message: string) { super(message); } }
export const invalid = (message: string) => new ServiceError(400, 'INVALID_REQUEST', message);
