import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { collectionsKeys } from "@/features/collections/queryKeys"
import {
  createMoodboard,
  fetchCollectionsWithPreviews,
  fetchFavorites,
  fetchCollectionProducts,
  fetchFavoriteProducts,
  fetchSavedProducts,
  fetchCollectionsMeta,
  fetchMoodboards,
  fetchCreations,
  fetchCreationsCounts,
  fetchTryOns,
  fetchMoodboardPreview,
  fetchMoodboardPreviews,
  fetchMoodboardOutfits,
  fetchMoodboardItems,
  deleteMoodboard,
  removeFromCollection,
  removeProductFromCollection,
  removeOutfitFromLibrary,
  removeProductFromLibrary,
  saveToCollection,
  saveProductToCollection,
} from "@/services/collections/collectionsService"

export function useCollectionsOverview() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.overview(),
    queryFn: () => fetchCollectionsWithPreviews(user?.id ?? null),
    staleTime: 30 * 60 * 1000,
  })
}

export function useMoodboards() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.moodboards(),
    queryFn: () => fetchMoodboards(user?.id ?? null),
    staleTime: 5 * 60 * 1000,
  })
}

export function useFavorites() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.favorites(),
    queryFn: () => fetchFavorites(user?.id ?? null),
    staleTime: 2 * 60 * 1000,
  })
}

export function useFavoriteProducts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.productFavorites(),
    queryFn: () => fetchFavoriteProducts(user?.id ?? null),
    staleTime: 2 * 60 * 1000,
  })
}

export function useSavedProducts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.products(),
    queryFn: () => fetchSavedProducts(user?.id ?? null),
    staleTime: 2 * 60 * 1000,
  })
}

export function useCollectionProducts(slug: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.collectionProducts(slug ?? "none"),
    queryFn: () => fetchCollectionProducts(user?.id ?? null, slug ?? ""),
    enabled: Boolean(user?.id && slug),
    staleTime: 2 * 60 * 1000,
  })
}

export function useCreateMoodboard() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.deleteMoodboard(),
    mutationFn: (name: string) => {
      if (!user?.id) {
        throw new Error("Please sign in to create a moodboard")
      }
      return createMoodboard(user.id, name)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.collectionsMeta() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
    },
  })
}

export function useDeleteMoodboard() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.createMoodboard(),
    mutationFn: (slug: string) => {
      if (!user?.id) {
        throw new Error("Please sign in to delete a moodboard")
      }
      return deleteMoodboard(user.id, slug)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.collectionsMeta() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useSaveToCollection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.saveToCollection(),
    mutationFn: (params: { outfitId: string; slug: string; label?: string }) => {
      if (!user?.id) {
        throw new Error("Please sign in to save outfits")
      }
      return saveToCollection({ ...params, userId: user.id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.favorites() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.tryOns() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useSaveProductToCollection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.saveProductToCollection(),
    mutationFn: (params: { productId: string; slug: string; label?: string }) => {
      if (!user?.id) {
        throw new Error("Please sign in to save products")
      }
      return saveProductToCollection({ ...params, userId: user.id })
    },
    onMutate: async (params) => {
      const normalizedSlug = params.slug.toLowerCase()
      await queryClient.cancelQueries({ queryKey: collectionsKeys.productFavorites() })
      const previousFavorites = queryClient.getQueryData<string[]>(collectionsKeys.productFavorites())

      if (normalizedSlug === "favorites") {
        queryClient.setQueryData<string[]>(collectionsKeys.productFavorites(), (current = []) => {
          if (current.includes(params.productId)) return current
          return [params.productId, ...current]
        })
      }

      return { previousFavorites }
    },
    onError: (_err, _params, context) => {
      if (!context?.previousFavorites) return
      queryClient.setQueryData<string[]>(collectionsKeys.productFavorites(), context.previousFavorites)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.productFavorites() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.products() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useRemoveFromCollection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.removeFromCollection(),
    mutationFn: (params: { outfitId: string; slug: string }) => {
      if (!user?.id) {
        throw new Error("Please sign in to remove outfits")
      }
      return removeFromCollection({ ...params, userId: user.id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.favorites() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.tryOns() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useRemoveProductFromCollection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.removeProductFromCollection(),
    mutationFn: (params: { productId: string; slug: string }) => {
      if (!user?.id) {
        throw new Error("Please sign in to remove products")
      }
      return removeProductFromCollection({ ...params, userId: user.id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.productFavorites() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.products() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useRemoveOutfitFromLibrary() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.removeOutfitFromLibrary(),
    mutationFn: (params: { outfitId: string }) => {
      if (!user?.id) {
        throw new Error("Please sign in to remove outfits")
      }
      return removeOutfitFromLibrary({ userId: user.id, outfitId: params.outfitId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.favorites() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.tryOns() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useRemoveProductFromLibrary() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: collectionsKeys.removeProductFromLibrary(),
    mutationFn: (params: { productId: string }) => {
      if (!user?.id) {
        throw new Error("Please sign in to remove products")
      }
      return removeProductFromLibrary({ userId: user.id, productId: params.productId })
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: collectionsKeys.productFavorites() })
      const previousFavorites = queryClient.getQueryData<string[]>(collectionsKeys.productFavorites())

      queryClient.setQueryData<string[]>(collectionsKeys.productFavorites(), (current = []) =>
        current.filter((id) => id !== params.productId),
      )

      return { previousFavorites }
    },
    onError: (_err, _params, context) => {
      if (!context?.previousFavorites) return
      queryClient.setQueryData<string[]>(collectionsKeys.productFavorites(), context.previousFavorites)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboards() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.productFavorites() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.products() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
    },
  })
}

export function useTryOns(size = 20) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: collectionsKeys.tryOns(size),
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) => fetchTryOns({ userId: user?.id ?? null, page: pageParam, size }),
    enabled: Boolean(user?.id),
    staleTime: 60 * 1000,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === size ? allPages.length : undefined),
  })
}

export function useCreations(size = 20) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: collectionsKeys.creations(size),
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) => fetchCreations({ userId: user?.id ?? null, page: pageParam, size }),
    enabled: Boolean(user?.id),
    staleTime: 30 * 60 * 1000,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === size ? allPages.length : undefined),
  })
}

export function useCreationsCounts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.creationsCounts(),
    queryFn: () => fetchCreationsCounts(user?.id ?? null),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
  })
}

export function useMoodboardOutfits(slug: string | null, size = 20, enabled = true) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: collectionsKeys.moodboardOutfits(slug ?? "", size),
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchMoodboardOutfits({ userId: user?.id ?? null, slug: slug ?? "", page: pageParam, size }),
    enabled: Boolean(user?.id && slug && enabled),
    staleTime: 60 * 1000,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === size ? allPages.length : undefined),
  })
}

export function useMoodboardItems(slug: string | null, size = 20, enabled = true) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: collectionsKeys.moodboardItems(slug ?? "", size),
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchMoodboardItems({ userId: user?.id ?? null, slug: slug ?? "", page: pageParam, size }),
    enabled: Boolean(user?.id && slug && enabled),
    staleTime: 60 * 1000,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === size ? allPages.length : undefined),
  })
}

export function useMoodboardPreview(slug: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.moodboardPreview(slug),
    queryFn: () => fetchMoodboardPreview(slug, user?.id ?? null),
    enabled: Boolean(user?.id) && Boolean(slug),
    staleTime: 2 * 60 * 1000,
  })
}

export function useMoodboardPreviews(slugs: string[]) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [...collectionsKeys.moodboardPreview("all"), ...slugs],
    queryFn: () => fetchMoodboardPreviews(slugs, user?.id ?? null),
    enabled: Boolean(user?.id) && slugs.length > 0,
    initialData: {},
    staleTime: 2 * 60 * 1000,
  })
}

export function useCollectionsMeta() {
  const { user } = useAuth()
  return useQuery({
    queryKey: collectionsKeys.collectionsMeta(),
    queryFn: () => fetchCollectionsMeta(user?.id ?? null),
    staleTime: 5 * 60 * 1000,
  })
}
