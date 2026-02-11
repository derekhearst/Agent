// Recipe & Meal Planning — Remote functions (query/command)
import { z } from 'zod';
import { query, command } from '$app/server';
import {
	db,
	recipe,
	mealPlan,
	mealPlanRecipe,
	shoppingList,
	shoppingListItem
} from '$lib/shared/db';
import { desc, eq, asc } from 'drizzle-orm';

// ============== TYPES ==============

export interface RecipeStep {
	stepNumber: number;
	title: string;
	description: string;
	duration?: string;
	tips?: string;
}

export interface RecipeIngredient {
	name: string;
	quantity: string;
	unit?: string;
	category?: string;
}

export type RecipeData = typeof recipe.$inferSelect;
export type MealPlanData = typeof mealPlan.$inferSelect;
export type ShoppingListData = typeof shoppingList.$inferSelect;
export type ShoppingListItemData = typeof shoppingListItem.$inferSelect;

export interface MealPlanWithRecipes extends MealPlanData {
	recipes: Array<{
		id: string;
		dayOfWeek: number;
		mealType: string;
		sortOrder: number;
		recipe: RecipeData;
	}>;
	shoppingLists: ShoppingListData[];
}

// ============== QUERIES ==============

export const getRecipes = query(async () => {
	return await db.query.recipe.findMany({
		orderBy: [desc(recipe.createdAt)]
	});
});

export const getRecipeById = query(z.string(), async (id) => {
	const result = await db.query.recipe.findFirst({
		where: eq(recipe.id, id)
	});
	if (!result) throw new Error('Recipe not found');
	return result;
});

export const getFavoriteRecipes = query(async () => {
	return await db.query.recipe.findMany({
		where: eq(recipe.isFavorite, true),
		orderBy: [desc(recipe.updatedAt)]
	});
});

export const getCurrentMealPlan = query(async () => {
	// Get the most recent active meal plan
	const plan = await db.query.mealPlan.findFirst({
		where: eq(mealPlan.status, 'active'),
		orderBy: [desc(mealPlan.createdAt)],
		with: {
			recipes: {
				with: {
					recipe: true
				},
				orderBy: [asc(mealPlanRecipe.dayOfWeek), asc(mealPlanRecipe.sortOrder)]
			},
			shoppingLists: {
				orderBy: [desc(shoppingList.createdAt)],
				limit: 1
			}
		}
	});
	return plan || null;
});

export const getMealPlanHistory = query(async () => {
	return await db.query.mealPlan.findMany({
		where: eq(mealPlan.status, 'completed'),
		orderBy: [desc(mealPlan.weekStartDate)],
		limit: 12,
		with: {
			recipes: {
				with: {
					recipe: true
				},
				orderBy: [asc(mealPlanRecipe.dayOfWeek)]
			}
		}
	});
});

export const getShoppingList = query(z.string(), async (listId) => {
	const list = await db.query.shoppingList.findFirst({
		where: eq(shoppingList.id, listId),
		with: {
			items: {
				orderBy: [asc(shoppingListItem.category), asc(shoppingListItem.ingredientName)]
			}
		}
	});
	if (!list) throw new Error('Shopping list not found');
	return list;
});

export const getShoppingListForPlan = query(z.string(), async (planId) => {
	const list = await db.query.shoppingList.findFirst({
		where: eq(shoppingList.mealPlanId, planId),
		orderBy: [desc(shoppingList.createdAt)],
		with: {
			items: {
				orderBy: [asc(shoppingListItem.category), asc(shoppingListItem.ingredientName)]
			}
		}
	});
	return list || null;
});

// ============== COMMANDS ==============

const recipeSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional().default(''),
	imageUrl: z.string().nullish(),
	sourceUrl: z.string().nullish(),
	source: z.enum(['web', 'atk', 'ai', 'user']).optional().default('ai'),
	cuisine: z.string().nullish(),
	prepTime: z.number().nullish(),
	cookTime: z.number().nullish(),
	servings: z.number().optional().default(2),
	steps: z.string().optional().default('[]'), // JSON string
	ingredients: z.string().optional().default('[]'), // JSON string
	tags: z.string().optional().default('[]'), // JSON string
	notes: z.string().nullish()
});

export const createRecipe = command(recipeSchema, async (data) => {
	const [newRecipe] = await db
		.insert(recipe)
		.values({
			title: data.title,
			description: data.description,
			imageUrl: data.imageUrl,
			sourceUrl: data.sourceUrl,
			source: data.source,
			cuisine: data.cuisine,
			prepTime: data.prepTime,
			cookTime: data.cookTime,
			servings: data.servings,
			steps: data.steps,
			ingredients: data.ingredients,
			tags: data.tags,
			notes: data.notes
		})
		.returning();

	await getRecipes().refresh();
	await getFavoriteRecipes().refresh();
	return newRecipe;
});

const updateRecipeSchema = z.object({
	id: z.string(),
	data: recipeSchema.partial()
});

export const updateRecipe = command(updateRecipeSchema, async ({ id, data }) => {
	const [updated] = await db
		.update(recipe)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(recipe.id, id))
		.returning();

	await getRecipes().refresh();
	await getRecipeById(id).refresh();
	await getFavoriteRecipes().refresh();
	return updated;
});

export const deleteRecipe = command(z.string(), async (id) => {
	await db.delete(recipe).where(eq(recipe.id, id));
	await getRecipes().refresh();
	await getFavoriteRecipes().refresh();
});

export const toggleFavorite = command(z.string(), async (id) => {
	const existing = await db.query.recipe.findFirst({ where: eq(recipe.id, id) });
	if (!existing) throw new Error('Recipe not found');

	const [updated] = await db
		.update(recipe)
		.set({ isFavorite: !existing.isFavorite, updatedAt: new Date() })
		.where(eq(recipe.id, id))
		.returning();

	await getRecipes().refresh();
	await getRecipeById(id).refresh();
	await getFavoriteRecipes().refresh();
	return updated;
});

// Meal plan commands

const createMealPlanSchema = z.object({
	weekStartDate: z.string(),
	mealCount: z.number().optional().default(5),
	servingsPerMeal: z.number().optional().default(2),
	recipeIds: z.array(
		z.object({
			recipeId: z.string(),
			dayOfWeek: z.number(),
			mealType: z.string().optional().default('dinner')
		})
	),
	shoppingItems: z
		.array(
			z.object({
				ingredientName: z.string(),
				quantity: z.string(),
				unit: z.string().nullish(),
				category: z.string().optional().default('other'),
				recipeId: z.string().nullish()
			})
		)
		.optional()
		.default([])
});

export const createMealPlan = command(createMealPlanSchema, async (data) => {
	// Mark any existing active plans as completed
	await db
		.update(mealPlan)
		.set({ status: 'completed', updatedAt: new Date() })
		.where(eq(mealPlan.status, 'active'));

	// Create the new meal plan
	const [plan] = await db
		.insert(mealPlan)
		.values({
			weekStartDate: data.weekStartDate,
			mealCount: data.mealCount,
			servingsPerMeal: data.servingsPerMeal,
			status: 'active'
		})
		.returning();

	// Link recipes
	if (data.recipeIds.length > 0) {
		await db.insert(mealPlanRecipe).values(
			data.recipeIds.map((r, i) => ({
				mealPlanId: plan.id,
				recipeId: r.recipeId,
				dayOfWeek: r.dayOfWeek,
				mealType: r.mealType,
				sortOrder: i
			}))
		);
	}

	// Create shopping list if items provided
	if (data.shoppingItems.length > 0) {
		const [list] = await db
			.insert(shoppingList)
			.values({
				mealPlanId: plan.id,
				status: 'pending'
			})
			.returning();

		await db.insert(shoppingListItem).values(
			data.shoppingItems.map((item) => ({
				shoppingListId: list.id,
				ingredientName: item.ingredientName,
				quantity: item.quantity,
				unit: item.unit,
				category: item.category,
				recipeId: item.recipeId
			}))
		);
	}

	await getCurrentMealPlan().refresh();
	await getMealPlanHistory().refresh();
	return plan;
});

export const completeMealPlan = command(z.string(), async (planId) => {
	await db
		.update(mealPlan)
		.set({ status: 'completed', updatedAt: new Date() })
		.where(eq(mealPlan.id, planId));

	await getCurrentMealPlan().refresh();
	await getMealPlanHistory().refresh();
});

// Shopping list commands

export const toggleShoppingItem = command(z.string(), async (itemId) => {
	const existing = await db.query.shoppingListItem.findFirst({
		where: eq(shoppingListItem.id, itemId)
	});
	if (!existing) throw new Error('Item not found');

	await db
		.update(shoppingListItem)
		.set({ checked: !existing.checked })
		.where(eq(shoppingListItem.id, itemId));

	await getShoppingList(existing.shoppingListId).refresh();
	await getShoppingListForPlan(
		(await db.query.shoppingList.findFirst({
			where: eq(shoppingList.id, existing.shoppingListId)
		}))!.mealPlanId
	).refresh();
});

export const approveShoppingList = command(z.string(), async (listId) => {
	await db
		.update(shoppingList)
		.set({ status: 'approved', updatedAt: new Date() })
		.where(eq(shoppingList.id, listId));

	const list = await db.query.shoppingList.findFirst({
		where: eq(shoppingList.id, listId)
	});
	if (list) {
		await getShoppingList(listId).refresh();
		await getShoppingListForPlan(list.mealPlanId).refresh();
		await getCurrentMealPlan().refresh();
	}
});

export const startOrdering = command(z.string(), async (listId) => {
	await db
		.update(shoppingList)
		.set({ status: 'ordering', updatedAt: new Date() })
		.where(eq(shoppingList.id, listId));

	const list = await db.query.shoppingList.findFirst({
		where: eq(shoppingList.id, listId)
	});
	if (list) {
		await getShoppingList(listId).refresh();
		await getShoppingListForPlan(list.mealPlanId).refresh();
	}
});

export const completeOrdering = command(z.string(), async (listId) => {
	await db
		.update(shoppingList)
		.set({ status: 'ordered', updatedAt: new Date() })
		.where(eq(shoppingList.id, listId));

	const list = await db.query.shoppingList.findFirst({
		where: eq(shoppingList.id, listId)
	});
	if (list) {
		await getShoppingList(listId).refresh();
		await getShoppingListForPlan(list.mealPlanId).refresh();
	}
});

export const markShoppingComplete = command(z.string(), async (listId) => {
	await db
		.update(shoppingList)
		.set({ status: 'completed', updatedAt: new Date() })
		.where(eq(shoppingList.id, listId));

	const list = await db.query.shoppingList.findFirst({
		where: eq(shoppingList.id, listId)
	});
	if (list) {
		await getShoppingList(listId).refresh();
		await getShoppingListForPlan(list.mealPlanId).refresh();
	}
});
