import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Express 4 не ловит reject из async-handlers — передаём в next(err). */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
