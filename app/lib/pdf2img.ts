export interface PdfConversionResult {
    imageUrl: string;
    file: File | null;
    error?: string;
}

let pdfjsLib: any = null;
let isLoading = false;
let loadPromise: Promise<any> | null = null;

async function loadPdfJs(): Promise<any> {
    if (pdfjsLib) return pdfjsLib;
    if (loadPromise) return loadPromise;

    isLoading = true;
    // @ts-expect-error - pdfjs-dist/build/pdf.mjs is not a module
    loadPromise = import("pdfjs-dist/build/pdf.mjs").then((lib) => {
            // Set the worker source to an available CDN version that matches the library version
            // Use unpkg which serves ES module worker (.mjs) files for this package/version
            lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs`;
        pdfjsLib = lib;
        isLoading = false;
        return lib;
    }).catch((err) => {
        // Fallback: try using the local public worker if CDN import fails
        try {
            lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            pdfjsLib = lib;
            isLoading = false;
            return lib;
        } catch (e) {
            isLoading = false;
            loadPromise = null;
            throw new Error(`Failed to load PDF.js library: ${err} / ${e}`);
        }
    });

    return loadPromise;
}

export async function convertPdfToImage(
    file: File
): Promise<PdfConversionResult> {
    try {
        const lib = await loadPdfJs();

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 3 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
            return {
                imageUrl: "",
                file: null,
                error: "Failed to get canvas context",
            };
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        await page.render({ canvasContext: context, viewport }).promise;

        return new Promise((resolve) => {
            // Use a timeout to prevent hanging if toBlob never calls the callback
            const timeoutId = setTimeout(() => {
                resolve({
                    imageUrl: "",
                    file: null,
                    error: "Canvas conversion timeout",
                });
            }, 10000);

            canvas.toBlob(
                (blob) => {
                    clearTimeout(timeoutId);
                    try {
                        if (!blob) {
                            resolve({
                                imageUrl: "",
                                file: null,
                                error: "Failed to create image blob",
                            });
                            return;
                        }

                        // Create a File from the blob with the same name as the pdf
                        const originalName = file.name.replace(/\.pdf$/i, "");
                        const imageFile = new File([blob], `${originalName}.png`, {
                            type: "image/png",
                        });

                        resolve({
                            imageUrl: URL.createObjectURL(blob),
                            file: imageFile,
                        });
                    } catch (blobErr) {
                        resolve({
                            imageUrl: "",
                            file: null,
                            error: `Failed to process blob: ${blobErr}`,
                        });
                    }
                },
                "image/png",
                0.95
            );
        });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("PDF conversion error:", errorMessage);
        return {
            imageUrl: "",
            file: null,
            error: `Failed to convert PDF: ${errorMessage}`,
        };
    }
}