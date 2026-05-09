declare global {
  namespace Express {
    interface Request {
      cabinetUser?: { id: string; email: string; appUserId: string };
    }
  }
}

export {};
