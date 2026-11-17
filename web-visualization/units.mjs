export const HOURS =(v)=> {
    return 1000 * 60 * 60 * v;
}

export const DAYS =(v)=> {
    return 1000 * 60 * 60 * 24 * v;
}

export const SECONDS =(v)=> {
    return 1000 * v;
}

export const MINUTES =(v)=> {
    return 1000 * 60 * v;
}

export const KB =(v)=> {
    return v * (2**10);
}

export const GB =(v)=> {
    return v * (2**30);
}

export const MB =(v)=> {
    return v * (2**20);
}
