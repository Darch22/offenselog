export async function checkEscalation(
    activeCount: number,
    currentTier: number,
    userId: string,
    userName: string,
    subredditId: string,
    subredditName: string
): Promise<number> {

    let newTier = 0;

    if(activeCount >= 8) newTier = 3;
    else if (activeCount >= 5) newTier = 2;
    else if (activeCount >= 3) newTier = 1;


    if (newTier > currentTier) {
        console.log(`Escalating ${userName} from Tier ${currentTier} to Tier ${newTier}`)
    }

    return newTier;

}