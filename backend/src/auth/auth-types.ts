export interface AuthContext {
    userId: string;
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
