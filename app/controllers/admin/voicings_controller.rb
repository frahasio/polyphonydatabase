module Admin
  class VoicingsController < AdminControllerBase
    def index; end

    def create
      voicing = Voicing.create(voicing_params)

      unless voicing.persisted?
        flash[:error] = voicing.errors.full_messages.to_sentence
      end

      redirect_to admin_voicings_path
    end

    def edit
      @voicing = Voicing.find(params[:id])
    end

    def update
      voicing = Voicing.find(params[:id])

      unless voicing.update(voicing_params)
        flash[:error] = voicing.errors.full_messages.to_sentence
      end

      redirect_to admin_voicings_path
    end

    def destroy
      voicing = Voicing.find(params[:id])

      unless voicing.destroy
        flash[:error] = voicing.errors.full_messages.to_sentence
      end

      redirect_to admin_voicings_path
    end

  private

    def voicing_params
      params.require(:voicing).permit(:text)
    end
  end
end
