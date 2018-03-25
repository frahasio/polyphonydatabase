module Admin
  class PublishersController < AdminControllerBase
    def index; end

    def create
      publisher = Publisher.create(publisher_params)

      unless publisher.persisted?
        flash[:error] = publisher.errors.full_messages.to_sentence
      end

      redirect_to admin_publishers_path
    end

    def edit
      @publisher = Publisher.find(params[:id])
    end

    def update
      publisher = Publisher.find(params[:id])

      unless publisher.update(publisher_params)
        flash[:error] = publisher.errors.full_messages.to_sentence
      end

      redirect_to admin_publishers_path
    end

    def destroy
      publisher = Publisher.find(params[:id])

      unless publisher.destroy
        flash[:error] = publisher.errors.full_messages.to_sentence
      end

      redirect_to admin_publishers_path
    end

  private

    def publisher_params
      params.require(:publisher).permit(:name)
    end
  end
end
