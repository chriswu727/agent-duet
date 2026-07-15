export function trustedRendererUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "duet:"
      && url.hostname === "app"
      && url.port === ""
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

export function trustedRendererFrame(frame) {
  try {
    return Boolean(frame && frame === frame.top && trustedRendererUrl(frame.url));
  } catch {
    return false;
  }
}
