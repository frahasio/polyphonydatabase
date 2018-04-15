module Admin
  class ClefCombinationsController < AdminControllerBase
    def index; end

    def create
      clef_combination = ClefCombination.create(clef_combination_params)

      unless clef_combination.persisted?
        flash[:error] = clef_combination.errors.full_messages.to_sentence
      end

      redirect_to admin_clef_combinations_path
    end

    def destroy
      clef_combination = ClefCombination.find(params[:id])

      unless clef_combination.destroy
        flash[:error] = clef_combination.errors.full_messages.to_sentence
      end

      redirect_to admin_clef_combinations_path
    end

  private

    def clef_combination_params
      params.require(:clef_combination).permit(:text)
    end
  end
end
