module Admin
  class ClefCombinationsController < AdminControllerBase
    def index
      @clef_combinations = ClefCombination
        .includes(:inclusions, :voicings)
        .order(:display)
        .page(params[:page])
        .per(50)

      @voicings = Voicing.order(:text)
    end

    def match
      params[:clef_combinations].each do |combo_id, voicing_params|
        combo = ClefCombination.find(combo_id)
        combo.voicings = Voicing.find(voicing_params[:voicings].reject(&:blank?))

        unless combo.save
          errors = combo.errors.full_messages
          flash[:error] ||= ""
          flash[:error] += "#{errors.to_sentence}\n"
        end
      end

      redirect_to admin_clef_combinations_path(page: params[:page])
    end
  end
end
