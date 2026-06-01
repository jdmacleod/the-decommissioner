import '@testing-library/jest-dom'

// jsdom does not implement scrollIntoView or scrollTo
Element.prototype.scrollIntoView = () => {}
window.scrollTo = () => {}
