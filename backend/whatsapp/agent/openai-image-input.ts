export type AgentImageInput = {
  buffer: Buffer;
  contentType: string;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function isUsableAgentImage(image: AgentImageInput | null | undefined): image is AgentImageInput {
  return Boolean(image?.buffer?.length);
}

function mimeFromContentType(contentType: string | undefined): string {
  const raw = String(contentType ?? '').trim().toLowerCase();
  if (raw === 'image/png' || raw === 'image/jpeg' || raw === 'image/jpg' || raw === 'image/webp' || raw === 'image/gif') {
    return raw === 'image/jpg' ? 'image/jpeg' : raw;
  }
  return 'image/jpeg';
}

/** Responses API user content: texto + input_image real (data URL). Sin OCR paralelo. */
export function buildOpenAiUserMessage(input: {
  text: string;
  image?: AgentImageInput | null;
}): { role: 'user'; content: string | Array<Record<string, unknown>> } {
  const text = String(input.text ?? '').trim();
  const image = isUsableAgentImage(input.image) ? input.image : null;
  if (!image) {
    return { role: 'user', content: text };
  }

  const buffer = image.buffer.length > MAX_IMAGE_BYTES ? image.buffer.subarray(0, MAX_IMAGE_BYTES) : image.buffer;
  const mime = mimeFromContentType(image.contentType);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const parts: Array<Record<string, unknown>> = [];
  if (text) {
    parts.push({ type: 'input_text', text });
  }
  parts.push({ type: 'input_image', image_url: dataUrl });
  return { role: 'user', content: parts };
}

export function openAiTimeoutMsForTurn(hasImage: boolean): number {
  return hasImage ? 45_000 : 25_000;
}
