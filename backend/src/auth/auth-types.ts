export interface AuthContext {
    userId: string;
    sessionVersion: number;
}

declare global {
    namespace Express {
        interface Request {
            auth?: AuthContext;
        }
    }
}

export interface AuthUser {
    id: string;
    name: string;
    email: string;
    createdAt: string;
}

export {};
