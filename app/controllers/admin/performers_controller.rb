module Admin
  class PerformersController < AdminControllerBase
    def index; end

    def create
      performer = Performer.create(performer_params)

      unless performer.persisted?
        flash[:error] = performer.errors.full_messages.to_sentence
      end

      redirect_to admin_performers_path
    end

    def edit
      @performer = Performer.find(params[:id])
    end

    def update
      performer = Performer.find(params[:id])

      unless performer.update(performer_params)
        flash[:error] = performer.errors.full_messages.to_sentence
      end

      redirect_to admin_performers_path
    end

    def destroy
      performer = Performer.find(params[:id])

      unless performer.destroy
        flash[:error] = performer.errors.full_messages.to_sentence
      end

      redirect_to admin_performers_path
    end

  private

    def performer_params
      params.require(:performer).permit(:name)
    end
  end
end
