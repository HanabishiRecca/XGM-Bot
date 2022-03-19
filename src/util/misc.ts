export const
    GenXgmUserLink = (xgmid: number) => `https://xgm.guru/user/${xgmid}`,
    GetUserCreationDate = (user_id: string) => Number(BigInt(user_id) >> 22n) + 1420070400000;

export const GenMap = <T extends { id: string; }>(arr?: T[]) => {
    const map = new Map<string, T>();
    if(Array.isArray(arr))
        for(const elem of arr)
            map.set(elem.id, elem);
    return map;
};
