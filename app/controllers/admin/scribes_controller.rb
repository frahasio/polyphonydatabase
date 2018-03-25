module Admin
  class ScribesController < AdminControllerBase
    def index; end

    def create
      scribe = Scribe.create(scribe_params)

      unless scribe.persisted?
        flash[:error] = scribe.errors.full_messages.to_sentence
      end

      redirect_to admin_scribes_path
    end

    def edit
      @scribe = Scribe.find(params[:id])
    end

    def update
      scribe = Scribe.find(params[:id])

      unless scribe.update(scribe_params)
        flash[:error] = scribe.errors.full_messages.to_sentence
      end

      redirect_to admin_scribes_path
    end

    def destroy
      scribe = Scribe.find(params[:id])

      unless scribe.destroy
        flash[:error] = scribe.errors.full_messages.to_sentence
      end

      redirect_to admin_scribes_path
    end

  private

    def scribe_params
      params.require(:scribe).permit(:name)
    end
  end
end
