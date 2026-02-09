import apiClient from './client';

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => { 
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function fetchAvatar(
    userId: number,
    size: 'large' | 'small'
): Promise<string> {
    const response = await apiClient.get<string>(`/avatar/${userId}/${size}`, {responseType: 'blob'});
    return URL.createObjectURL(response.data);
}

export async function uploadAvatar(
    large: Blob,
    small: Blob
) : Promise<void> {
    const [largeB64, smallB64] = await Promise.all([
        blobToBase64(large),
        blobToBase64(small)
    ]);
    await apiClient.post('/avatar', {large: largeB64, small: smallB64});
}

export async function deleteAvatar() : Promise<void> {
    await apiClient.delete<void>('/avatar');
}