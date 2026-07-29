export async function withDeadline<T>(operation: () => Promise<T>, milliseconds = 810_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request deadline exceeded after ${milliseconds}ms.`)), milliseconds);
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

