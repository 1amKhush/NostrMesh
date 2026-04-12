"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.isApiError = isApiError;
exports.relayErrorCode = relayErrorCode;
exports.relayErrorMessage = relayErrorMessage;
exports.errorMessage = errorMessage;
class ApiError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.ApiError = ApiError;
function isApiError(error) {
    return error instanceof ApiError;
}
function relayErrorCode(error, action) {
    if (error instanceof AggregateError || messageHasAllPromisesRejected(error)) {
        return `relay_${action}_failed`;
    }
    return `relay_${action}_error`;
}
function relayErrorMessage(error, action) {
    const reason = errorMessage(error);
    return `Relay ${action} failed: ${reason}`;
}
function errorMessage(error) {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }
    return "Unknown error";
}
function messageHasAllPromisesRejected(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    return /all promises were rejected/i.test(error.message);
}
