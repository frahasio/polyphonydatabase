module Admin
  class TitlesController < AdminControllerBase
    def index
      @titles = Title
        .includes(:functions)
        .select("titles.*, count(inclusions.id) as inclusions_count")
          .joins(compositions: :inclusions)
          .group("titles.id")
        .order(:text)
      @functions = Function.order(:name)
    end

    def update
      title = Title.find(params[:id])

      unless title.update(title_params)
        flash[:error] = title.errors.full_messages.to_sentence
      end

      redirect_to admin_titles_path
    end

  private

    def title_params
      params.require(:title).permit(
        :text,
        function_ids: [],
      )
    end
  end
end
