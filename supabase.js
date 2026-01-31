import { supabase, supabaseAdmin } from "./Client.js";

export const InsertTransaction = async (
  projectId,
  bidId,
  clientId,
  freelancerId,
  amount,
  platformFee,
  freelancerAmount,
  paymentIntentId,
) => {
  try {
    const { data: transaction, error: transError } = await supabase
      .from("transactions")
      .insert({
        project_id: projectId,
        bid_id: bidId,
        client_id: clientId,
        freelancer_id: freelancerId,
        amount,
        platform_fee: platformFee,
        freelancer_amount: freelancerAmount,
        status: "pending",
        payment_provider: "stripe",
        payment_intent_id: paymentIntentId,
      })
      .select()
      .single();

    if (transError) {
      console.error("Transaction insert error:", transError);
      return { transaction: null, error: transError };
    }

    console.log("Transaction created:", transaction.id);
    return { transaction, error: null };
  } catch (error) {
    console.error("insert transaction error:", error);
    return { transaction: null, error };
  }
};
export const Commission = async () => {
  try {
    const { data: settingData, error: settingError } = await supabase
      .from("platform_settings")
      .select("setting_value")
      .eq("setting_key", "commission_rate")
      .single();
    if (settingError) {
      console.error("Error fetching commission rate:", settingError);
    }
    return settingData;
  } catch (error) {
    console.error("get commissionRate error:", error);
  }
};
export const updateTransaction = async (Intent) => {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .update({
        status: "held_in_escrow",
        escrowed_at: new Date().toISOString(),
      })
      .eq("payment_intent_id", Intent)
      .select()
      .single();
    if (error) {
      console.error("Transaction update error:", error);
      return { data: null, error };
    }

    if (!data) {
      return { data: null, error: new Error("Transaction not found") };
    }

    console.log("Transaction updated to escrow:", data);

    return { data, error: null };
  } catch (error) {
    console.error("update transaction error:", error);
    return { data: null, error };
  }
};
export const getTransaction = async (transactionId) => {
  try {
    const { data: transaction, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .single();

    if (error) {
      console.error("getTransaction error:", error);
      return { transaction: null, error };
    }

    if (!transaction) {
      return {
        transaction: null,
        error: new Error("Transaction not found"),
      };
    }

    console.log("Transaction found:", transaction.id);

    return { transaction, error: null };
  } catch (error) {
    console.error("getTransaction catch error:", error);
    return { transaction: null, error };
  }
};

export const updateById = async (transactionId, updates = {}) => {
  try {
    const defaultUpdates = {
      status: "released",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("transactions")
      .update({ ...defaultUpdates, ...updates })
      .eq("id", transactionId)
      .select()
      .single();

    if (error) {
      console.error("Transaction update error:", error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error("Transaction update catch error:", error);
    return { data: null, error };
  }
};
// Update project by its ID
export const updateProject = async (id) => {
  try {
    // First check if project exists
    const { data: existingProject, error: fetchError } = await supabase
      .from("projects")
      .select("id, status")
      .eq("id", id)
      .maybeSingle(); // Use maybeSingle() instead of single()

    if (fetchError) {
      console.error("Error fetching project:", fetchError);
      return { data: null, error: fetchError };
    }

    if (!existingProject) {
      console.error(`Project not found with id: ${id}`);
      return { 
        data: null, 
        error: { message: `Project not found with id: ${id}` } 
      };
    }

    console.log("Found project:", existingProject);

    // Update the project
    const { data, error } = await supabase
      .from("projects")
      .update({ status: "completed" })
      .eq("id", id)
      .select()
      .maybeSingle(); // Use maybeSingle() to handle 0 or 1 rows

    if (error) {
      console.error("Failed to update project status:", error);
      return { data: null, error };
    }

    if (!data) {
      console.error("No project was updated");
      return { 
        data: null, 
        error: { message: "No project was updated" } 
      };
    }

    console.log("Project updated successfully:", data);
    return { data, error: null };
    
  } catch (error) {
    console.error("Projects table update catch error:", error);
    return { data: null, error };
  }
};

// Get freelancer's Stripe account ID
export const getFreelancerStripeAccount = async (userId) => {
  try {
    const { data, error } = await supabase
      .from("freelancer_profiles")
      .select("stripe_account_id")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.error("Get Stripe account error:", error);
      return { stripeAccountId: null, error };
    }

    return {
      stripeAccountId: data?.stripe_account_id || null,
      error: null,
    };
  } catch (error) {
    console.error("Get Stripe account catch error:", error);
    return { stripeAccountId: null, error };
  }
};

// Update freelancer's Stripe account ID
export const updateFreelancerStripeAccount = async (
  userId,
  stripeAccountId,
) => {
  try {
    const { data, error } = await supabase
      .from("freelancer_profiles")
      .upsert(
        {
          user_id: userId,
          stripe_account_id: stripeAccountId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
          ignoreDuplicates: false,
        },
      )
      .select()
      .single();

    if (error) {
      console.error("Update Stripe account error:", error);
      return { data: null, error };
    }

    console.log("Stripe account ID updated for user:", userId);
    return { data, error: null };
  } catch (error) {
    console.error("Update Stripe account catch error:", error);
    return { data: null, error };
  }
};

// Remove freelancer's Stripe account ID
export const removeFreelancerStripeAccount = async (userId) => {
  try {
    const { data, error } = await supabase
      .from("freelancer_profiles")
      .update({
        stripe_account_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Remove Stripe account error:", error);
      return { data: null, error };
    }

    console.log("Stripe account removed for user:", userId);
    return { data, error: null };
  } catch (error) {
    console.error("Remove Stripe account catch error:", error);
    return { data: null, error };
  }
};
export const profileCheck = async (userId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("freelancer_profiles")
      .select("stripe_account_id")
      .eq("user_id", userId);
    if (error) {
      console.error("profileCheck account error:", error);
      return { data: null, error };
    }
    console.log("profile Check data returned:", data);
    return { data, error: null };
  } catch (error) {
    console.error("profileCheck account catch error:", error);
    return { data: null, error };
  }
};
export const updateLancer = async (userId, accountId) => {
  try {
    const { error, data } = await supabaseAdmin
      .from("freelancer_profiles")
      .upsert(
        {
          user_id: userId,
          stripe_account_id: accountId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
          ignoreDuplicates: false,
        },
      );
    if (error) {
      console.error("update freelance profile error:", error);
      return { data: null, error };
    }
    return { data, error: null };
  } catch (error) {
    console.error("update freelance profile catch error:", error);
    return { data: null, error };
  }
};
