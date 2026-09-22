export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return {
    code: 'INTERNAL',
    message: '処理に失敗しました。入力は保持されています。もう一度お試しください。',
  };
}
