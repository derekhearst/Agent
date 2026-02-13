// Recipe Agent Tools — used by the Meal Planner agent
import type { ToolHandler } from '$lib/tools/tools';
import {
	db,
	recipe,
	mealPlan,
	mealPlanRecipe,
	shoppingList,
	shoppingListItem
} from '$lib/shared/db';
import { eq, desc, asc } from 'drizzle-orm';

// ============== save_recipe ==============

export const saveRecipeTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'save_recipe',
			description:
				'Save a recipe to the database. Steps can have any number of entries — do NOT artificially limit to 6; include ALL steps from the source or that are needed to properly prepare the dish. Each step should have a stepNumber, title, description, and optionally duration and tips.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Recipe title' },
					description: { type: 'string', description: 'Brief description of the dish' },
					imageUrl: { type: 'string', description: 'URL to recipe image (if available)' },
					sourceUrl: { type: 'string', description: 'Original recipe URL (if from web)' },
					source: {
						type: 'string',
						enum: ['web', 'atk', 'ai', 'user'],
						description: 'Where the recipe came from'
					},
					cuisine: { type: 'string', description: 'Cuisine type (e.g. Italian, Mexican, Asian)' },
					prepTime: { type: 'number', description: 'Prep time in minutes' },
					cookTime: { type: 'number', description: 'Cook time in minutes' },
					servings: { type: 'number', description: 'Number of servings (default 2)' },
					steps: {
						type: 'array',
						description: 'All preparation steps — include every step needed, do not truncate',
						items: {
							type: 'object',
							properties: {
								stepNumber: { type: 'number' },
								title: { type: 'string', description: 'Short step title' },
								description: {
									type: 'string',
									description: 'Detailed step instructions'
								},
								duration: { type: 'string', description: 'Time for this step (e.g. "5 min")' },
								tips: { type: 'string', description: 'Optional tips for this step' }
							},
							required: ['stepNumber', 'title', 'description']
						}
					},
					ingredients: {
						type: 'array',
						description: 'All ingredients needed',
						items: {
							type: 'object',
							properties: {
								name: { type: 'string' },
								quantity: { type: 'string' },
								unit: { type: 'string' },
								category: {
									type: 'string',
									enum: [
										'produce',
										'dairy',
										'meat',
										'seafood',
										'pantry',
										'frozen',
										'bakery',
										'spices',
										'condiments',
										'other'
									]
								}
							},
							required: ['name', 'quantity']
						}
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Tags like "quick", "comfort food", "healthy", etc.'
					}
				},
				required: ['title', 'description', 'steps', 'ingredients']
			}
		}
	},
	execute: async (args) => {
		const [newRecipe] = await db
			.insert(recipe)
			.values({
				title: args.title as string,
				description: (args.description as string) || '',
				imageUrl: (args.imageUrl as string) || null,
				sourceUrl: (args.sourceUrl as string) || null,
				source: (args.source as 'web' | 'atk' | 'ai' | 'user') || 'ai',
				cuisine: (args.cuisine as string) || null,
				prepTime: (args.prepTime as number) || null,
				cookTime: (args.cookTime as number) || null,
				servings: (args.servings as number) || 2,
				steps: JSON.stringify(args.steps || []),
				ingredients: JSON.stringify(args.ingredients || []),
				tags: JSON.stringify(args.tags || [])
			})
			.returning();

		return {
			content: `Recipe "${newRecipe.title}" saved successfully with ID: ${newRecipe.id}. It has ${(args.steps as unknown[])?.length || 0} steps and ${(args.ingredients as unknown[])?.length || 0} ingredients.${!args.imageUrl ? ' WARNING: No image URL was provided — look for the recipe image in the ### Images section of browser_extract output and include it next time.' : ''}`
		};
	}
};

// ============== create_meal_plan ==============

export const createMealPlanTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'create_meal_plan',
			description:
				'Create a weekly meal plan from saved recipe IDs. Also generates a consolidated shopping list by combining ingredients from all recipes. Automatically deduplicates and combines quantities for the same ingredients.',
			parameters: {
				type: 'object',
				properties: {
					weekStartDate: {
						type: 'string',
						description: 'ISO date for Saturday start of the week, e.g. "2026-02-14"'
					},
					mealCount: {
						type: 'number',
						description: 'Number of meals (default 5)'
					},
					servingsPerMeal: {
						type: 'number',
						description: 'Servings per meal (default 2)'
					},
					meals: {
						type: 'array',
						description: 'Array of recipe assignments for each meal',
						items: {
							type: 'object',
							properties: {
								recipeId: { type: 'string', description: 'ID of the saved recipe' },
								dayOfWeek: {
									type: 'number',
									description:
										'0=Saturday, 1=Sunday, 2=Monday, 3=Tuesday, 4=Wednesday, 5=Thursday, 6=Friday'
								}
							},
							required: ['recipeId', 'dayOfWeek']
						}
					}
				},
				required: ['weekStartDate', 'meals']
			}
		}
	},
	execute: async (args) => {
		const meals = args.meals as Array<{ recipeId: string; dayOfWeek: number }>;
		const weekStartDate = args.weekStartDate as string;
		const mealCount = (args.mealCount as number) || 5;
		const servingsPerMeal = (args.servingsPerMeal as number) || 2;

		// Mark existing active plans as completed
		await db
			.update(mealPlan)
			.set({ status: 'completed', updatedAt: new Date() })
			.where(eq(mealPlan.status, 'active'));

		// Create plan
		const [plan] = await db
			.insert(mealPlan)
			.values({
				weekStartDate,
				mealCount,
				servingsPerMeal,
				status: 'active'
			})
			.returning();

		// Link recipes
		await db.insert(mealPlanRecipe).values(
			meals.map((m, i) => ({
				mealPlanId: plan.id,
				recipeId: m.recipeId,
				dayOfWeek: m.dayOfWeek,
				mealType: 'dinner',
				sortOrder: i
			}))
		);

		// Gather all ingredients from linked recipes and build shopping list
		const recipeIds = meals.map((m) => m.recipeId);
		const recipes = await Promise.all(
			recipeIds.map((id) => db.query.recipe.findFirst({ where: eq(recipe.id, id) }))
		);

		// Consolidate ingredients
		const ingredientMap = new Map<
			string,
			{ name: string; quantity: string; unit?: string; category: string; recipeId?: string }
		>();

		for (const r of recipes) {
			if (!r) continue;
			try {
				const ingredients = JSON.parse(r.ingredients) as Array<{
					name: string;
					quantity: string;
					unit?: string;
					category?: string;
				}>;
				for (const ing of ingredients) {
					const key = `${ing.name.toLowerCase()}-${(ing.unit || '').toLowerCase()}`;
					if (ingredientMap.has(key)) {
						const existing = ingredientMap.get(key)!;
						// Try to combine quantities
						const existingQty = parseFloat(existing.quantity);
						const newQty = parseFloat(ing.quantity);
						if (!isNaN(existingQty) && !isNaN(newQty)) {
							existing.quantity = String(existingQty + newQty);
						} else {
							existing.quantity = `${existing.quantity} + ${ing.quantity}`;
						}
					} else {
						ingredientMap.set(key, {
							name: ing.name,
							quantity: ing.quantity,
							unit: ing.unit,
							category: ing.category || 'other',
							recipeId: r.id
						});
					}
				}
			} catch {
				// Skip malformed ingredients
			}
		}

		// Create shopping list
		if (ingredientMap.size > 0) {
			const [list] = await db
				.insert(shoppingList)
				.values({ mealPlanId: plan.id, status: 'pending' })
				.returning();

			await db.insert(shoppingListItem).values(
				Array.from(ingredientMap.values()).map((item) => ({
					shoppingListId: list.id,
					ingredientName: item.name,
					quantity: item.quantity,
					unit: item.unit || null,
					category: item.category,
					recipeId: item.recipeId || null
				}))
			);
		}

		return {
			content: `Meal plan created for week of ${weekStartDate} with ${meals.length} meals and ${ingredientMap.size} shopping list items. Plan ID: ${plan.id}. The shopping list is in "pending" status — the user will review and approve it in the UI before adding to Fred Meyer cart.`
		};
	}
};

// ============== search_recipes ==============

export const searchRecipesTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'search_recipes',
			description:
				'Search saved recipes by title, cuisine, tags, or get favorites. Use this to find existing recipes to avoid duplicates and to incorporate user favorites into meal plans.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search term for title/description/tags' },
					cuisine: { type: 'string', description: 'Filter by cuisine type' },
					favoritesOnly: {
						type: 'boolean',
						description: 'Only return favorited recipes'
					},
					limit: { type: 'number', description: 'Max results (default 20)' }
				}
			}
		}
	},
	execute: async (args) => {
		const searchQuery = args.query as string | undefined;
		const cuisine = args.cuisine as string | undefined;
		const favoritesOnly = args.favoritesOnly as boolean | undefined;
		const limit = (args.limit as number) || 20;

		let results = await db.query.recipe.findMany({
			orderBy: [desc(recipe.updatedAt)],
			limit: limit * 2 // Fetch extra to filter
		});

		if (favoritesOnly) {
			results = results.filter((r) => r.isFavorite);
		}

		if (cuisine) {
			results = results.filter((r) => r.cuisine?.toLowerCase().includes(cuisine.toLowerCase()));
		}

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			results = results.filter(
				(r) =>
					r.title.toLowerCase().includes(q) ||
					r.description.toLowerCase().includes(q) ||
					r.tags.toLowerCase().includes(q) ||
					(r.cuisine?.toLowerCase().includes(q) ?? false)
			);
		}

		results = results.slice(0, limit);

		const summary = results
			.map(
				(r) =>
					`- "${r.title}" (ID: ${r.id}) — ${r.cuisine || 'No cuisine'}, ${r.isFavorite ? '⭐ Favorite' : ''} ${r.prepTime ? r.prepTime + 'min prep' : ''}`
			)
			.join('\n');

		return {
			content: results.length
				? `Found ${results.length} recipe(s):\n${summary}`
				: 'No recipes found matching your criteria.'
		};
	}
};

// ============== add_to_fred_meyer_cart ==============

export const addToFredMeyerCartTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'add_to_fred_meyer_cart',
			description:
				'Add shopping list items to Fred Meyer online cart using browser automation. Only call this AFTER the user has approved the shopping list in the UI. The shopping list status must be "approved" before this tool will work.',
			parameters: {
				type: 'object',
				properties: {
					shoppingListId: { type: 'string', description: 'ID of the approved shopping list' }
				},
				required: ['shoppingListId']
			}
		}
	},
	execute: async (args) => {
		const listId = args.shoppingListId as string;

		// Check if approved
		const list = await db.query.shoppingList.findFirst({
			where: eq(shoppingList.id, listId),
			with: { items: true }
		});

		if (!list) return { content: 'Shopping list not found.' };
		if (list.status !== 'approved') {
			return {
				content: `Shopping list status is "${list.status}" — it must be "approved" by the user before adding to cart. Wait for user approval in the Recipes tab.`
			};
		}

		// Mark as ordering
		await db
			.update(shoppingList)
			.set({ status: 'ordering', updatedAt: new Date() })
			.where(eq(shoppingList.id, listId));

		const uncheckedItems = list.items.filter((item) => !item.checked);

		// Return instructions for the agent to use browser tools
		const itemList = uncheckedItems
			.map((item) => `- ${item.quantity} ${item.unit || ''} ${item.ingredientName}`.trim())
			.join('\n');

		return {
			content: `Shopping list approved! ${uncheckedItems.length} items to add to Fred Meyer cart:\n${itemList}\n\nNow use browse_url to navigate to fredmeyer.com, log in if needed, then search and add each item to the cart using browser_act. After completing all items, call complete_fred_meyer_order with the shopping list ID.`
		};
	}
};

// ============== complete_fred_meyer_order ==============

export const completeFredMeyerOrderTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'complete_fred_meyer_order',
			description:
				'Mark a shopping list as ordered after successfully adding all items to the Fred Meyer cart. This does NOT checkout or place an order — the user will review the cart and checkout manually.',
			parameters: {
				type: 'object',
				properties: {
					shoppingListId: { type: 'string', description: 'ID of the shopping list' },
					summary: {
						type: 'string',
						description: 'Summary of what was added, any items that failed, etc.'
					}
				},
				required: ['shoppingListId']
			}
		}
	},
	execute: async (args) => {
		const listId = args.shoppingListId as string;
		await db
			.update(shoppingList)
			.set({ status: 'ordered', updatedAt: new Date() })
			.where(eq(shoppingList.id, listId));

		return {
			content: `Shopping list marked as ordered. Summary: ${(args.summary as string) || 'Completed'}`
		};
	}
};

// ============== get_approved_shopping_list ==============

export const getApprovedShoppingListTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'get_approved_shopping_list',
			description:
				'Get the most recent approved shopping list with all its items. Use this to find what items need to be added to the Fred Meyer cart.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	execute: async () => {
		const list = await db.query.shoppingList.findFirst({
			where: eq(shoppingList.status, 'approved'),
			orderBy: [desc(shoppingList.createdAt)],
			with: {
				items: {
					orderBy: [asc(shoppingListItem.category), asc(shoppingListItem.ingredientName)]
				}
			}
		});

		if (!list) {
			return {
				content:
					'No approved shopping lists found. The user needs to approve a shopping list first.'
			};
		}

		const itemsByCategory = new Map<string, string[]>();
		for (const item of list.items) {
			if (item.checked) continue;
			const cat = item.category || 'other';
			if (!itemsByCategory.has(cat)) itemsByCategory.set(cat, []);
			itemsByCategory
				.get(cat)!
				.push(`- ${item.quantity} ${item.unit || ''} ${item.ingredientName}`.trim());
		}

		let output = `Shopping List ID: ${list.id}\nStatus: ${list.status}\nTotal items: ${list.items.length}\n\nItems by category:\n`;
		for (const [cat, items] of itemsByCategory) {
			output += `\n### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n${items.join('\n')}\n`;
		}

		return { content: output };
	}
};
