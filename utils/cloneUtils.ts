
export const safeDeepClone = <T,>(obj: T): T => {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        const arr = new Array(obj.length);
        for (let i = 0; i < obj.length; i++) {
            arr[i] = safeDeepClone(obj[i]);
        }
        return arr as any;
    }

    const clone: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            clone[key] = safeDeepClone(obj[key]);
        }
    }
    return clone;
};
