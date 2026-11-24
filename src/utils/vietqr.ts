function tlv(tag: string, value: string): string {
  const length = String(value.length).padStart(2, '0');
  return `${tag}${length}${value}`;
}

export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface VietQrParams {
  bankBin?: string;
  accountNumber: string;
  amount: number;
  orderId: string;
}

export function buildVietQrPayload({
  bankBin = '970441', // VIB Bank BIN
  accountNumber,
  amount,
  orderId,
}: VietQrParams): string {
  const roundedAmount = Math.max(0, Math.round(amount));
  const cleanOrderId = orderId
    .replace(/[^a-zA-Z0-9- ]/g, '')
    .trim()
    .slice(0, 25);

  const bankAndAccount = tlv('00', bankBin) + tlv('01', accountNumber.trim());
  const merchantAccountInfo =
    tlv('00', 'A000000727') +
    tlv('01', bankAndAccount) +
    tlv('02', 'QRIBFTTA');

  const parts = [
    tlv('00', '01'),
    tlv('01', roundedAmount > 0 ? '12' : '11'),
    tlv('38', merchantAccountInfo),
    tlv('53', '704'),
  ];

  if (roundedAmount > 0) {
    parts.push(tlv('54', String(roundedAmount)));
  }

  parts.push(tlv('58', 'VN'));

  if (cleanOrderId) {
    parts.push(tlv('62', tlv('08', cleanOrderId)));
  }

  const withoutCrc = `${parts.join('')}6304`;
  const crc = crc16CcittFalse(withoutCrc);
  return `${withoutCrc}${crc}`;
}
