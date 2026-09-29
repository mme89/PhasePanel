type PdfSeries = { label: string; color: string };

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const SCALE = 2;

function dateTime(time: number) {
  return new Date(time).toLocaleString();
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y);
    return;
  }
  let shortened = text;
  while (shortened && context.measureText(`${shortened}…`).width > maxWidth)
    shortened = shortened.slice(0, -1);
  context.fillText(`${shortened}…`, x, y);
}

async function drawSvg(
  context: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(
    new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('The history chart could not be rendered.'));
      image.src = url;
    });
    context.drawImage(image, x, y, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadHistoryPdf({
  filename,
  title,
  start,
  end,
  series,
  chart,
}: {
  filename: string;
  title: string;
  start: number;
  end: number;
  series: PdfSeries[];
  chart: SVGSVGElement | null;
}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE_WIDTH * SCALE);
  canvas.height = Math.round(PAGE_HEIGHT * SCALE);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create a PDF canvas.');
  context.scale(SCALE, SCALE);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#275c45';
  context.font = 'bold 8px Arial, sans-serif';
  context.fillText('PHASEPANEL / VALUE HISTORY', 40, 43);
  context.fillStyle = '#21382d';
  context.font = 'bold 22px Arial, sans-serif';
  context.fillText('Value history report', 40, 73);
  context.font = '11px Arial, sans-serif';
  drawFittedText(context, title, 40, 95, PAGE_WIDTH - 80);
  context.fillStyle = '#52665a';
  context.font = '9px Arial, sans-serif';
  drawFittedText(
    context,
    `Visible chart window: ${dateTime(start)} to ${dateTime(end)}`,
    40,
    116,
    PAGE_WIDTH - 80,
  );
  context.strokeStyle = '#275c45';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(40, 137);
  context.lineTo(PAGE_WIDTH - 40, 137);
  context.stroke();
  context.fillStyle = '#21382d';
  context.font = 'bold 12px Arial, sans-serif';
  context.fillText('Values over time', 40, 166);

  if (chart) {
    await drawSvg(context, chart, 40, 180, PAGE_WIDTH - 80, 243);
  } else {
    context.font = '11px Arial, sans-serif';
    context.fillStyle = '#52665a';
    context.fillText('No fresh values in this chart window.', 40, 290);
  }
  context.fillStyle = '#52665a';
  context.font = '8px Arial, sans-serif';
  context.fillText(dateTime(start), 80, 440);
  context.textAlign = 'right';
  context.fillText(dateTime(end), PAGE_WIDTH - 40, 440);
  context.textAlign = 'left';

  const columns = Math.min(3, Math.max(1, Math.ceil(series.length / 6)));
  const rowsPerColumn = Math.ceil(series.length / columns);
  const columnWidth = (PAGE_WIDTH - 80) / columns;
  context.font = '8px Arial, sans-serif';
  series.forEach((item, index) => {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const x = 40 + column * columnWidth;
    const y = 465 + row * 15;
    context.fillStyle = item.color;
    context.fillRect(x, y - 3, 14, 2);
    context.fillStyle = '#21382d';
    drawFittedText(context, item.label, x + 20, y, columnWidth - 28);
  });

  const { PDFDocument } = await import('pdf-lib');
  const pdfDocument = await PDFDocument.create();
  pdfDocument.setTitle(filename);
  const image = await pdfDocument.embedPng(canvas.toDataURL('image/png'));
  const page = pdfDocument.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  const bytes = await pdfDocument.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/pdf' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
