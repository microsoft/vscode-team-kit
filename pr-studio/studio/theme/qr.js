// QR code as crisp SVG modules (qrcode, MIT), so the end card can be scanned from a shared screen.
import QRCode from 'qrcode';

export function qrCode(parent, text, { x, y, size, color = '#1b1b1f' }) {
	const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const n = qr.modules.size;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', `0 0 ${n + 2} ${n + 2}`);
	Object.assign(svg.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` });
	let d = '';
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (qr.modules.get(r, c)) {
				d += `M${c + 1} ${r + 1}h1v1h-1z`;
			}
		}
	}
	const path = document.createElementNS(svg.namespaceURI, 'path');
	path.setAttribute('d', d);
	path.setAttribute('fill', color);
	path.setAttribute('shape-rendering', 'crispEdges');
	svg.appendChild(path);
	svg.dataset.qr = text;
	parent.appendChild(svg);
	return svg;
}
