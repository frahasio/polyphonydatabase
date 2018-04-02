module Admin
  class TitlesController < AdminControllerBase
    def index
      @titles = Title
        .includes(:functions)
        .select("titles.*, count(inclusions.id) as inclusions_count")
          .joins(compositions: :inclusions)
          .group("titles.id")
        .order(:text)
        .page(params[:page])
        .per(50)

      @functions = Function.order(:name)
    end

    def update_all
      params.require(:titles).each do |id, title_params|
        title_params = title_params.permit(
          :text,
          function_ids: [],
        )

        update_title(id, title_params)
      end

      redirect_to admin_titles_path
    end

    private

    def update_title(id, title_params)
      title = Title.find(id)

      title.assign_attributes(title_params)

      if title.text_changed? && (other_title = Title.find_by(text: title.text))
        title.functions += other_title.functions
        title.compositions += other_title.compositions
        other_title.destroy!
      end

      unless title.save
        errors = title.errors.full_messages
        flash[:error] ||= ""
        flash[:error] += "#{errors.to_sentence}\n"
      end
    end
  end
end
