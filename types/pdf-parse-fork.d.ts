declare module 'pdf-parse-fork' {
  export interface PDFParseResult {
    numpages: number
    numrender: number
    info: Record<string, unknown>
    metadata: Record<string, unknown>
    text: string
    version: string
  }

  export function PDFParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PDFParseResult>

  export default PDFParse
}
