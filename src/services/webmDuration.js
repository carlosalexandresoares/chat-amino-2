// MediaRecorder's WebM output commonly has no Segment Info/Duration. Read the
// timestamps of its audio blocks instead of trusting a duration sent by a client.
function vint(buffer, offset, keepMarker = false) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  if (!first) return null;
  let width = 1;
  while (width <= 8 && !(first & (0x80 >> (width - 1)))) width++;
  if (width > 8 || offset + width > buffer.length) return null;
  let value = keepMarker ? first : first & (0xff >> width);
  let unknown = !keepMarker && value === (0xff >> width);
  for (let i = 1; i < width; i++) {
    value = value * 256 + buffer[offset + i];
    unknown &&= buffer[offset + i] === 0xff;
  }
  if (!unknown && !Number.isSafeInteger(value)) return null;
  return { value: unknown ? null : value, width, unknown };
}

function unsigned(buffer, start, end) {
  if (end <= start || end - start > 6) return null;
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + buffer[i];
  return value;
}

function webmDuration(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.readUInt32BE(0) !== 0x1a45dfa3) return null;
  let scale = 1000000; // Matroska default nanoseconds per timecode tick
  let maxTick = -1;
  let clusterTick = null;
  let foundSegment = false;
  let foundBlock = false;

  function scan(start, end, parent) {
    let offset = start;
    while (offset < end) {
      const id = vint(buffer, offset, true);
      if (!id) return null;
      offset += id.width;
      const size = vint(buffer, offset);
      if (!size) return null;
      offset += size.width;
      if (parent === 0x1f43b675 && id.value === 0x1f43b675) return offset - id.width - size.width;
      if (size.unknown && ![0x18538067, 0x1f43b675].includes(id.value)) return null;
      const valueEnd = size.unknown ? end : offset + size.value;
      if (valueEnd > end || valueEnd < offset) return null;
      if (id.value === 0x18538067) {
        foundSegment = true;
        const next = scan(offset, valueEnd, id.value);
        if (next === null) return null;
        offset = next;
        continue;
      } else if (id.value === 0x1549a966 || id.value === 0x1f43b675 || id.value === 0xa0) {
        if (id.value === 0x1f43b675) clusterTick = null;
        const next = scan(offset, valueEnd, id.value);
        if (next === null || (!size.unknown && next !== valueEnd)) return null;
        offset = next;
        continue;
      } else if (parent === 0x1549a966 && id.value === 0x2ad7b1) {
        scale = unsigned(buffer, offset, valueEnd);
        if (!scale || scale > 1000000000) return null;
      } else if (parent === 0x1f43b675 && id.value === 0xe7) {
        clusterTick = unsigned(buffer, offset, valueEnd);
        if (clusterTick === null) return null;
      } else if ((parent === 0x1f43b675 && id.value === 0xa3) || (parent === 0xa0 && id.value === 0xa1)) {
        if (clusterTick === null) return null;
        const track = vint(buffer, offset);
        if (!track || !track.value || offset + track.width + 3 >= valueEnd) return null;
        const relative = buffer.readInt16BE(offset + track.width);
        const tick = clusterTick + relative;
        if (tick < 0) return null;
        maxTick = Math.max(maxTick, tick);
        foundBlock = true;
      }
      offset = valueEnd;
    }
    return offset;
  }

  if (scan(0, buffer.length, 0) !== buffer.length || !foundSegment || !foundBlock) return null;
  return maxTick * scale / 1000000000 + 0.02;
}

module.exports = webmDuration;
