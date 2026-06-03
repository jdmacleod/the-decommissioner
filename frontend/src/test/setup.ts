import '@testing-library/jest-dom'

// jsdom does not implement scrollIntoView or scrollTo
Element.prototype.scrollIntoView = () => {}
window.scrollTo = () => {}

// jsdom does not implement URL.createObjectURL / revokeObjectURL
URL.createObjectURL = (blob: Blob) => `blob:mock/${(blob as File).name ?? 'file'}`
URL.revokeObjectURL = () => {}
