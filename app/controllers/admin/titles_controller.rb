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
      titles_to_update.each do |id, title_params|
        update_title(id, title_params)
      end

      redirect_to admin_titles_path
    end

    private

    def update_title(id, title_params)
      title = Title.find_by(id: id)
      return unless title

      title_params = title_params.permit(
        :text,
        function_ids: [],
      )

      title.assign_attributes(title_params)

      if title.text_changed? && (other_title = Title.find_by(text: title.text))
        other_id = other_title.id.to_s

        if (other_update_params = titles_to_update[other_id])
          update_title(other_id, other_update_params)
        end

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

    def titles_to_update
      params.require(:titles)
    end
  end
end
